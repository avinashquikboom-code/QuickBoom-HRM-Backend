# Bill 134: source sale timestamp and commission consistency

The reported API error is a date-normalization failure before subcategory/rate lookup. `commissionSource: SUBCATEGORY` was describing the attempted policy family, not proof that a mapping or rule had been resolved. Consequently, subcategory/rate IDs stayed null when normalization stopped. Unresolved calculations now identify their source as `UNRESOLVED` and explain the timestamp error explicitly.

The source paths previously disagreed:

- `calculateInvoiceCommission` copied raw invoiceDate/date into the normalizer, or replaced missing values with a persisted createdAt, dropping source/receipt provenance and other timestamp aliases.
- The normalizer originally required a timezone on clock timestamps; a working-tree fallback instead assumed +05:30 for every naive clock. Neither inferring a source timezone from an unrelated UTC createdAt nor assigning the host/profile timezone is valid.
- Ingestion's legacy `safeParseDate` stripped Z and subtracted 5.5 hours. `parseSaleDateCorrectly` now preserves explicit UTC/offset instants, and invoice ingestion uses the same source-aware result as calculation.
- Invoice details recomputed pending commissions while wallet/activity read stale error snapshots. Their read paths now share a read-only pending-invoice projection. This does not approve invoices, post wallet credits, or change finalized records.

`invoiceSaleTime.ts` selects semantic sale fields (invoiceDate/saleDate/generatedDate/date and their aliases) before the source invoice's createdAt. It keeps the selected raw value, field, normalized instant and timezone provenance separate from database sale createdAt and webhook receipt createdAt. If a source field exists but its zone cannot be verified, a persisted Date is not used to conceal that error.

Explicit Z/offset values remain authoritative. A naive clock requires explicit source timezone metadata, or a verified source contract from SystemSetting.integrations:

- `hopkidStoreTimezones[storeId]` for that store, or
- `hopkidInvoiceTimeZone` only if the HopKid integration has a verified common timezone.

Source metadata may declare saleTimeZone/timeZone/timezone. createdAtTimeZone applies only when createdAt is the selected source field, not to a different invoice date. Existing date-only IST calendar contracts remain supported. Invalid dates, invalid IANA zones, and ambiguous/nonexistent DST local times remain errors. No setting or timezone value was invented or written by this change. Store has no timezone column; Profile.timezone and the server timezone are not store/source evidence.

The existing exact product/variant mapping and invoice-date-effective subcategory rate lookup remain authoritative. Tests use DIVA's supplied product/variant UUIDs, store 66 and eligible amount 1690 with an isolated configured fixture rate. The fixture rate and amount are not claims about production configuration. Current catalog names/categories can enrich display fields by exact product ID; they do not authorize a guessed or future-effective commission mapping.

Pending repair uses the same calculation, corrects the pending sale timestamp only when verified, records the old/new timestamps in audit, and applies only the wallet delta under the existing lock. Repeating apply cannot credit the row twice. APPROVED/PAID records are not recalculated or selected for repair.

Read-only production evidence command:

```sh
./node_modules/.bin/ts-node --transpile-only scripts/diagnose_mobile_invoice.ts 133,134 827ddbdb-3733-41b8-b8f1-900231834629 4311451b-2639-450a-82c5-4a9e6fc461fe
```

The diagnostic now includes whitelisted raw timestamp fields, database/receipt timestamps, timezone resolution/error, exact variant membership, category/subcategory mappings and existing rates. Credentials and customer details are not printed.

After source timezone and mapping/rate evidence are verified, preview repair using an existing administrator ID:

```sh
./node_modules/.bin/ts-node --transpile-only scripts/reconcile_pending_invoice_commissions.ts --actor-id ADMIN_ID --bill-id 133 --bill-id 134
```

Only after verifying the preview should the same command be run with `--apply`.

Live diagnostic on this machine returned ECONNREFUSED. Therefore the actual timestamp strings, store 66 timezone, DIVA category/subcategory, applicable production rate and production earned amount remain unverified. No live reconciliation was performed. A request for the raw timestamp/timezone evidence is pending in the chat.

Regression coverage: source/receipt timezone separation, Z and numeric offsets, verified IANA store timezone, invalid/ambiguous clocks, exact DIVA identity fixture, configured calculation on 1690, detail/wallet read parity, no writes on reads/previews, timestamp audit, idempotent credit and finalized-history protection. Flutter retains its existing design and distinguishes genuine timestamp errors from missing product data.
