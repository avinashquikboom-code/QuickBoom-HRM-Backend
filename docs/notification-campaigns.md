# Notification campaign implementation and deployment

## Shared implementation

The canonical admin UI is `/notifications`, Campaigns tab; `/notifications/send` uses the same `CampaignPanel`. All categories use the existing Notification, Employee, Store, Branch, Department, User, FCMToken and Device relationships. Employee/store/branch IDs are integers; campaign IDs are UUID strings. Existing in-app history, Firebase multicast delivery, mobile images/action links, authentication middleware and node-cron are reused.

Campaign categories: `BIRTHDAY`, `PROMOTION`, `HOLIDAY`, `FESTIVAL`, `ANNOUNCEMENT`, `CUSTOM`. Audience modes: `ALL_EMPLOYEES`, `STORES`, `BRANCHES`, `EMPLOYEES`, `DEPARTMENTS`, `ROLES`, `COMBINED`. Combined targeting is a union, with each employee selected once.

ADMIN, SUPER_ADMIN and PLATFORM_ADMIN have organization-wide targeting. HR requires an active employee assignment and is scoped to its own store or branch, with campaign management limited to campaigns it created. HR cannot target all employees or select other stores/branches/departments. Ordinary employees cannot manage campaigns. The current database has no tenant relationship on Employee/Store; this implementation is for the existing single-organization database and excludes Campaign rows with a non-null legacy companyId. It must not be treated as a general shared-database multi-tenant implementation.

## Canonical API

Base: `/api/admin/notification-management/campaigns`. All requests require the existing Bearer authentication. Errors use `{ "success": false, "message": "..." }`; validation is 400, unauthorized access 403, unknown/inaccessible campaign 404, conflicting state 409, unavailable image hosting configuration 503, unexpected errors 500. Authentication middleware also returns 401.

| Method | Path | Request | Success response |
| --- | --- | --- | --- |
| GET | `/options` | None | 200 `{success:true,data:{stores:[{id,name}],branches:[{id,name}],departments:[{id,name}],roles:string[],canTargetAll:boolean,timezone:string}}` |
| GET | `/employees?q=&page=1&limit=20` | Search name/code; page >=1, limit 1–100 | 200 `{success:true,data:[{id,firstName,lastName,employeeCode,storeId,branchId}],total,page,limit}` |
| GET | `/birthdays/today` | None | 200 `{success:true,date:"YYYY-MM-DD",timezone,data:[{id,firstName,lastName}]}` |
| POST | `/image` | `{imageBase64:"data:image/png;base64,..."}` | 201 `{success:true,data:{imageUrl:"https://.../uploads/campaigns/UUID.png"}}` |
| GET | `/?q=&status=&page=1&limit=20` | Optional title search and exact status | 200 `{success:true,data:Campaign[],total,page,limit}` |
| POST | `/` | Full campaign input below | 201 `{success:true,data:Campaign}`; creates draft, schedule or automatic template without claiming delivery |
| GET | `/:id` | None | 200 `{success:true,data:{...Campaign,summary:{states:{SENT:1},readCount:0,total:1}}}` |
| PUT | `/:id` | Full campaign input | 200 `{success:true,data:Campaign}`; only draft/scheduled, optimistic concurrency check |
| POST | `/:id/send` | `{}` | 202 `{success:true,message:"Campaign queued; delivery has not completed",data:Campaign}` |
| POST | `/:id/schedule` | `{scheduledAt:"2026-12-25T03:30:00.000Z"}` | 200 `{success:true}`; future date, draft/scheduled only |
| POST | `/:id/cancel` | `{}` | 200 `{success:true}`; draft/scheduled/automatic/blocked only |
| GET | `/:id/recipients?page=1&limit=20` | Pagination | 200 `{success:true,data:[{id,employeeId,deliveryStatus,failureReason,employee:{firstName,lastName},isRead,readAt}],total,page,limit}` |

Creation and update input (optional URLs may be null; omit scheduledAt for a draft):

```json
{
  "title": "Festival greeting",
  "message": "Wishing everyone a wonderful festival!",
  "notificationType": "FESTIVAL",
  "imageUrl": null,
  "actionUrl": "https://example.com/offers",
  "audienceType": "COMBINED",
  "audienceCriteria": {
    "storeIds": [1, 2],
    "branchIds": [],
    "employeeIds": [7],
    "departmentIds": [],
    "roles": [],
    "birthdayOnly": false,
    "automaticBirthday": false,
    "timezone": "Asia/Kolkata"
  },
  "scheduledAt": "2026-12-25T03:30:00.000Z"
}
```

Example creation result (the actual response includes the remaining persisted Campaign fields):

```json
{
  "success": true,
  "data": {
    "id": "e4af5e1c-2d84-48d0-b08f-cf7f7b6d6d62",
    "title": "Festival greeting",
    "message": "Wishing everyone a wonderful festival!",
    "notificationType": "FESTIVAL",
    "status": "SCHEDULED",
    "scheduledAt": "2026-12-25T03:30:00.000Z",
    "totalRecipients": 0,
    "sentCount": 0,
    "failedCount": 0,
    "readCount": 0
  }
}
```

Images are optional. Uploads accept PNG/JPEG/WebP signatures, maximum 2 MB. Configure `PUBLIC_API_URL` to the publicly reachable HTTPS backend origin, and persist/share `uploads/campaigns` across instances. Existing HTTPS-hosted images can be supplied directly. Action links use HTTPS, supported by the existing mobile link handler.

Employee APIs remain compatible: GET `/api/mobile/notifications`, GET `/:notificationId`, PUT/PATCH `/:notificationId/read`, PUT/PATCH `/read-all`; new PUT/PATCH `/:notificationId/unread` returns `{success:true,message:"Notification marked as unread"}` and checks recipient ownership. History includes campaignId, imageUrl and actionUrl. Canonical read state is Notification.isRead/readAt; detail summaries and recipient responses query this source rather than assuming legacy counters are current.

## Scheduler and delivery semantics

The existing node-cron infrastructure runs one registered campaign tick per minute, with a process guard, persisted conditional campaign claims and recipient claims. Scheduled work is queued only after its due time. Recipients are resolved from current database membership when queued and checked again for active status/access before delivery. Related queue and recipient snapshot writes use a transaction and 1,000-row batches. Each tick handles at most 10 queued campaigns and 50 recipients per campaign. FCM token groups are at most 500.

For automatic birthdays use category BIRTHDAY, birthdayOnly=true and automaticBirthday=true. The worker creates one child occurrence per template and local date. A unique `birthday:TEMPLATE_ID:YYYY-MM-DD` dedupeKey prevents competing processes creating two occurrences. CampaignRecipient has a unique (campaignId,employeeId) key, and Notification has a unique nullable (campaignId,employeeId) key. A date of birth is a calendar date stored in the existing timestamp column; matching uses its stored UTC month/day, with today's calendar date computed in the configured timezone. February 29 matches February 29 only. No dates are invented. Company timezone defaults from SystemSetting.company.timezone, then Asia/Kolkata; campaigns persist their timezone. Automatic jobs run on the first tick on each local date; no historical backfill is performed.

States include PENDING, SENDING, RETRY, SENT, FAILED, PARTIAL, UNKNOWN, SKIPPED and IN_APP_ONLY. SENT means FCM accepted the push, not verified delivery. No device-delivered claim is made. A recipient without tokens still receives an in-app notification and is IN_APP_ONLY. Terminal campaign states are COMPLETED or COMPLETED_WITH_ERRORS.

Each device token is represented by a SHA-256 key in persisted tokenStates; raw tokens are not returned by campaign APIs. Token attempts are recorded before calling FCM. Explicit transient rejection can retry up to three attempts; accepted tokens are excluded from subsequent attempts. Transport exceptions, missing provider responses or recovered SENDING attempts become UNKNOWN and are not automatically resent. This favors avoiding duplicates over guaranteeing push delivery across an ambiguous external-provider failure. In-app history is retained. Invalid registration tokens are deactivated in FCMToken and removed from the fallback Device registration table.

## Database changes

The existing `20261013120000_add_campaign_notification_management` migration already defines Campaign, CampaignRecipient, Employee.dateOfBirth and notification campaign/image fields. Prisma schema/client were reconciled with it, rather than creating duplicate tables.

New additive migration: `20261019120000_campaign_delivery_safety` adds Campaign.dedupeKey, Campaign.lockedAt, CampaignRecipient.tokenStates, and unique indexes on campaign dedupeKey and Notification(campaignId,employeeId). Existing history with null campaignId is unaffected. If legacy non-null campaign/employee notification duplicates exist, the index intentionally fails rather than deleting history.

The read-only inspection of the configured database on 19 October 2026 found dateOfBirth and imageUrl present, 0_init finished, and the existing campaign migration finished. That is a snapshot of this connection, not proof that another deployment/database has the same migration history. The new migration was tested locally and was not applied to production by this implementation.

## Deployment

1. Back up the deployment database using the established workflow.
2. Run `node scripts/inspect_notification_schema.cjs` against the intended database; it performs read-only column/migration inspection and prints no credentials. Verify the migration ledger and column types. Check duplicate non-null campaignId/employeeId notification groups before creating the unique index.
3. If 0_init is failed in that database, investigate its actual logs and compare every required object against the existing baseline. Do not reset/drop the database, rerun the baseline blindly, or mark it applied without evidence. This implementation does not run migrate resolve.
4. Install dependencies and run `npx prisma generate`, `npx prisma migrate status`, then `npx prisma migrate deploy` only after resolving any verified ledger/schema mismatch. Abort startup on migration failure.
5. Set PUBLIC_API_URL and persist the upload directory. Existing FCM credentials/configuration are reused. Never test with production recipients.
6. Deploy backend and frontend together. Keep at least one backend process running for cron scheduling. Check queued/blocked/unknown states and recipient results after deployment. HR users need a valid active store/branch assignment.
7. Fixed development authentication tokens are now accepted only when NODE_ENV=development and ALLOW_DEV_AUTH_TOKENS=true. Production must use normal signed authentication.

Concurrent workspace edits introduced compatibility routes and a separate `/campaigns` UI while implementation was running. Those additions are outside the canonical Notification workflow described above. They were not part of the passing canonical-route integration tests. Concurrent edits also removed entrypoint.sh while Dockerfile.deploy and Dockerfile.production still reference it; reconcile that deployment mismatch before building/deploying those images.

## Verification

- Backend Prisma Client generation, typecheck and production build passed before the last concurrent commit.
- 20 PostgreSQL integration checks passed using an isolated temporary local cluster and mocked FCM. The checks cover data-preserving migrations, targeting modes, overlap, scope denial, invalid input, timezone/leap-day matching, creation/edit/cancel, queue idempotency, partial failure retries, unknown outcomes, birthday occurrence deduplication, scheduled dispatch, image upload and employee read/unread history.
- Run again: `npm run test:notification-campaigns`. Requires local initdb, pg_ctl and createdb. The script creates a separate temporary PostgreSQL cluster, refuses a non-test database URL, and stops the cluster afterward.
- Frontend production build passed. The existing Next configuration skips build type validation; standalone `tsc --noEmit` reported pre-existing RegisterRole/SALESMAN and commission transaction typing errors outside the notification implementation.
- Flutter analysis of the modified notification provider and detail sheet passed.
- Browser test script: HRM-Admin-Pannel/scripts/test_notification_campaign_ui.cjs. All API requests are mocked. The browser run was interrupted and has not been recorded as passing.
- No real production pushes were sent. Production migrations were not applied.

## Files

Backend: prisma/schema.prisma; prisma/migrations/20261019120000_campaign_delivery_safety/migration.sql; src/services/campaignPolicy.ts; src/services/campaignService.ts; src/services/campaignScheduler.ts; src/routes/campaignRoutes.ts; src/routes/notificationManagementRoutes.ts; src/index.ts; src/services/firebaseNotificationService.ts; src/middlewares/authMiddleware.ts; src/controllers/mobile/mobileNotificationController.ts; src/routes/mobile/mobileNotificationRoutes.ts; scripts/inspect_notification_schema.cjs; scripts/notification_campaign_integration.ts; scripts/test_notification_campaigns.cjs; package.json; this report. Concurrent changes also modified src/utils/db.ts and removed entrypoint.sh.

Admin: src/features/notifications/pages/CampaignPanel.tsx; NotificationsPage.tsx; SendNotificationPage.tsx; src/services/notificationService.ts; scripts/test_notification_campaign_ui.cjs. Other campaign files were introduced concurrently.

Mobile: lib/features/notification/presentation/providers/notification_viewmodel.dart; lib/features/notification/presentation/widgets/notification_detail_sheet.dart. Existing notification model, image preview, action link handling and history UI are reused.
