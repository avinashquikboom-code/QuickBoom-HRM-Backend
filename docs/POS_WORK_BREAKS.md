# Employee breaks and billing drafts

Personal authenticated POS users own their billing drafts. Shared store-terminal
credentials do not identify an employee, so these logins must use a personal
account for break/resume. Selecting a salesperson does not change draft ownership.

## Storage and rollout

Migration `20261024210000_pos_work_breaks` adds `POSBillingDraft` and `POSWorkBreak`.
Drafts reference the authenticated user, employee where linked, store and register
session; completion links the draft to the one persisted invoice. Partial unique
indexes enforce one active draft per account and one active break per draft.
Breaks record server timestamps, duration in seconds, register and store at start.
They do not change attendance, inventory, commissions or cash reconciliation.

Before deploying the updated backend/frontend against an existing environment:

```
npx prisma migrate deploy
npx prisma generate
npm run build
```

Run migration commands with that environment's normal configured database URL.
No production migration is applied by the tests.

## Authenticated endpoints under /api/v1/pos

- `GET /work-state`: retrieve this account's active draft/break after store checks.
- `PUT /work-state`: autosave an allowlisted, versioned billing snapshot. Accepts
  `storeId`, optional `sessionId`/`draftId`, `revision`, UUID `requestKey`, `snapshot`.
- `POST /work-state/break`: same payload; atomically save inputs and start a break.
- `POST /work-state/resume`: accepts `breakId` and optional authorized open
  `sessionId`; ends the break and returns the unchanged saved inputs.
- `POST /sales`: additionally accepts `billingDraftId` and `billingDraftRevision`.
  Server prices and validates the sale as before and completes the draft in the
  same transaction. On-break accounts cannot checkout, including from another tab.

Saves are serialized and debounced in the UI. The Saving indicator represents
unacknowledged edits; Take Break and checkout explicitly flush all pending inputs.
The last server-acknowledged snapshot survives refresh/crash/logout. Only billing
fields are allowlisted; card numbers, CVV, PIN or gateway credentials are rejected.

Draft revisions reject competing edits in another tab. A failed save keeps local
inputs and offers Retry or explicit Load saved bill. Lost break requests keep the
screen locked until an exact retry confirms the server result. Resume retries use
the original break ID. Server permissions are checked on every request; expired
sessions display reauthentication instructions without exposing saved state.

If a register closed, the draft remains paused. Open a new personal register
session for that store (the break screen links to Registers), then Resume Work.
The new session is validated server-side; original opening/closing amounts remain
unchanged. Clearing a bill must save successfully before switching stores; the
old empty draft is archived, retaining its break history.

## Tests

Both integration suites require an isolated local PostgreSQL database named with
`pos_test` on port `55439`. `DATABASE_URL` must equal `POS_TEST_DATABASE_URL` for
backend tests; the browser harness sets it for its real backend process.

```
NODE_ENV=production npx ts-node --transpile-only scripts/test_pos_work_breaks.ts
```

From the frontend directory, after its build:

```
NODE_ENV=production node scripts/test_pos_work_breaks.cjs
npx tsc --noEmit --incremental false
```

The browser suite uses actual authenticated POS routes and PostgreSQL. It only
stubs unrelated HRM chrome APIs and injects dropped responses/invalid signed
sessions to verify recovery. It covers manual/catalog inputs, employee assignment,
split payments, refresh, authentication failure, lost break/resume responses,
mobile controls and exactly one invoice after resuming. Backend tests additionally
cover owner/store isolation, concurrent retries, closed-register recovery,
optimistic conflicts, audits and no pre-sale inventory/payment writes.
