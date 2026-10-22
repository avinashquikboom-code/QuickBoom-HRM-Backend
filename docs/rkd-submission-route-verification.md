# RKD submission route verification

## Endpoint and findings

The existing endpoint is POST /api/employee/rkd: src/index.ts mounts employeeRkdRouter at /api/employee/rkd, and src/routes/rkdRoutes.ts registers POST /. Flutter's AppUrl.employeeRkd already uses this exact URL. There was no missing submission controller, method mismatch, or Flutter URL error, so no duplicate route or URL change was added.

A local routing defect was reproduced through real HTTP: the broader /api/employee router ran before RKD and applied its role gate to every nested request. Its allowed roles omit SALESMAN. A valid active sales-account JWT received 403 before the RKD controller could authorize that sales employee. The existing RKD mount now runs before that broad router; RKD retains its own authentication and sales-employee eligibility checks.

The reported 404 Cannot POST was not reproduced against this checkout. A credential-free probe of https://api.voxiqai.com/api/employee/rkd returned HTTP 401 with the authentication-required JSON message. Broad middleware can produce that response even if a downstream handler is absent, so this does not prove that the affected running server has the RKD router. A stale/different deployed build, instance or request origin remains a possible explanation for the reported 404; none is confirmed without the affected runtime evidence. No authenticated production request was sent.

## Changes

- src/index.ts: move the one existing RKD mount before the general employee role middleware.
- src/controllers/rkdController.ts: validate a JSON object, nonempty product/particulars, positive integer quantity within Prisma Int range, finite numeric commission input, optional string/null sale reference and optional nonempty string idempotency key. Reject arrays/objects and partial numeric strings. Preserve the existing missing/negative commission fallback calculation. The requesting employee still comes from the authenticated token/profile, never employeeId in the JSON body.
- src/services/rkdNotificationWorkflow.ts: perform sale-reference duplicate checking after idempotency replay lookup, so replaying the same request with a reference returns the existing record and emits no second notification.
- scripts/test_rkd_submission_route.cjs: real local HTTP integration test with the actual routers, JWT authentication middleware, controller and submission service. It reads relevant mount prefixes/order from src/index.ts, and compiled mode verifies dist/index.js has matching mount order and uses compiled routers. Database and FCM work are mocked.
- scripts/test_rkd_payroll_wallet.cjs: add the sale-reference lookup to its database fixture after moving that check into the shared submission service.

Initial status remains PENDING. No salary/wallet credit occurs until the separate HR workflow. Submission notification runs only after a successful new insert; replay and failed inserts do not send it. HR review, payroll and wallet accounting logic are unchanged.

## Validation

- npm run build: passed.
- node scripts/test_rkd_submission_route.cjs: passed against source routes after the fix. Before the fix, its valid SALESMAN POST reproduced HTTP 403.
- node scripts/test_rkd_submission_route.cjs --compiled: passed using the compiled routers and matching compiled main-app mount order. Covers the supplied null-reference body -> 201, active account JWT authentication, missing/invalid JWT -> 401, nonsales employee -> 403, token-derived employee despite spoofed body IDs, initial PENDING/no salary credit, input rejection -> 400, idempotent retries (including optional sale references), changed-payload conflict -> 409, and failed persistence -> 500 without a notification.
- scripts/test_rkd_workflow.cjs: all 8 controller workflow cases passed.
- scripts/test_rkd_route_ids.cjs: passed.
- scripts/test_rkd_payroll_wallet.cjs: passed.
- git diff --check: passed.

No schema migration, database reset, production data mutation, Docker/deployment configuration change, service restart or deployment was performed. Local route registration is verified. Resolution of the originally reported 404 on the affected runtime still requires confirming its running build/base URL/instance; this report does not claim a production fix or authenticated production submission.
