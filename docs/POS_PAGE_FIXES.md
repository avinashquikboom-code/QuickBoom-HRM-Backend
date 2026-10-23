# POS page error fixes — 23 October 2026

## Findings and targeted changes

### POS context 422
The frontend performs `GET /api/v1/pos/context` with its existing authenticated Axios client and no body or query by default. The Express POS router handles the context directly after `authenticate`; there is no separate context controller or request-body schema. Authentication resolves User → Employee → Store and role/user permissions from the database. Company metadata is read from SystemSetting; companyId and branchId are not required context parameters. Branch is not the retail Store entity.

The real router reproduced this exact response for a permitted cashier with no store assignment:

```json
{"success":false,"message":"No store location is assigned to your employee account. Please contact an administrator to assign an active store."}
```

The same bodyless request returned HTTP 200 for an authorized cashier with an active assigned store, including actor.employeeId/storeId, activeStore, the scoped stores array, salesperson and payment methods. No frontend ID injection or database assignment change is appropriate. A non-admin account must have its existing employee profile linked and an active Store assigned by an administrator. Missing employee linkage now has its own actionable 422; inactive stores identify the corrective action. Repeated storeId parameters are rejected rather than implicitly coerced. Authentication, permission checks and store isolation remain enforced.

Both POS screens now share bootstrap query options: no automatic retries, retry on mount, focus or reconnect. Successful context is fresh for 60 seconds. The explicit Retry button remains available after configuration is corrected. This prevents repeated failures when moving between the fullscreen terminal and the operations workspace.

The user's existing browser session could not be inspected because computer-use permission was unavailable. The response above was read from a real HTTP request against the real router and an isolated PostgreSQL fixture; it is not a claim that the production account's assignment was inspected.

### Dashboard 404
Three POS error/empty-state links used `/dashboard`, which has no Next.js page. Existing portal homes are `/live-dashboard`, `/super-admin`, and `/employee`. POS now resolves those links through the existing role/portal home helpers. The valid dashboard RSC request returns 200. Next's API rewrite only matches `/api/*`; no basePath, middleware, deployment rewrite or HRM navigation changes were needed.

### Chart dimensions
The live dashboard hiring chart directly mounted Recharts ResponsiveContainer with its default initial width/height of -1 before the parent was measured. The shared chart wrapper now uses ResizeObserver and mounts the chart only when the parent has positive width and height, supplying that measured initial dimension. The live chart uses that wrapper with `min-w-0`, `w-full` and a defined `h-44` height. Loading/error states do not render it; a failed organization-statistics request clears stale chart data and displays an actionable error.

## Files modified

Backend:
- `src/pos/routes.ts` — targeted context validation and missing-configuration messages.
- `scripts/test_pos_context_auth.ts` — real HTTP regressions with unique fixtures and a strict local test database guard; replaces the old test's fixed IDs and unguarded writes.
- `package.json` — `test:pos:context` command.
- `docs/POS_PAGE_FIXES.md` — this report.

Frontend:
- `src/features/pos/contextQuery.ts` — shared bounded bootstrap behavior.
- `src/features/pos/POSBillingScreen.tsx` — uses shared query and existing portal home routing.
- `src/features/pos/POSWorkspace.tsx` — uses shared query.
- `src/components/ChartContainer.tsx` — measured responsive container; retains existing height/config props.
- `src/features/dashboard/pages/LiveDashboardPage.tsx` — measured hiring chart and error/loading handling.
- `scripts/test_pos_page_errors.cjs` — browser routing, retry and chart regressions.
- `package.json` — `test:pos:pages` command.

No database schema, migrations, production data, POS financial logic, authentication or permissions were changed.

## Verification
- Backend build: passed.
- Real HTTP context checks: 12 passed, including admin and assigned cashier 200, missing auth 401, cross-store 403, missing employee/store or inactive store 422, malformed/duplicate storeId 400.
- Existing isolated POS integration suite: 47 passed.
- Frontend production build: passed. Existing `ignoreBuildErrors` configuration remains unchanged.
- Focused ESLint and diff whitespace checks: passed.
- Browser page regression: checks one 422 request without automatic retry/remount loops, explicit retry recovery, valid portal dashboard links, dashboard RSC 200, positive chart dimensions at 1440px and 390px, and no chart rendered after an HR-statistics error. Console/page errors and Network 404/unexpected API failures are checked. Expected fixture 422/500 responses are intentional test scenarios. Browser API fixtures are mocked; backend authorization is independently checked against real PostgreSQL.
- Repository-wide frontend TypeScript still reports pre-existing errors in RegisterUserWithRights.tsx, PayrollPage.tsx and commissionService.ts. Changed files introduced no TypeScript diagnostics.

Commands from each respective repository:

```sh
# Backend: requires a deliberately configured isolated local database (port 55439,
# database name containing pos_test); never use the production DATABASE_URL.
DATABASE_URL="$POS_TEST_DATABASE_URL" NODE_ENV=production JWT_SECRET=isolated-test-secret npm run test:pos:context
DATABASE_URL="$POS_TEST_DATABASE_URL" NODE_ENV=production JWT_SECRET=isolated-test-secret npm run test:pos
npm run build

# Frontend
npm run build
npm run test:pos:pages
npx eslint src/components/ChartContainer.tsx src/features/pos/contextQuery.ts src/features/pos/POSBillingScreen.tsx src/features/pos/POSWorkspace.tsx
```

Browser checks use the installed macOS Google Chrome executable; CHROME_PATH can override it. These changes have not been deployed to production.
