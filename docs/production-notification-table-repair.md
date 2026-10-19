# Production notification table repair

## Confirmed cause and scope

The supplied production logs report P2021 for public.NotificationRule and public.NotificationTemplate. Both models and their tables/indexes are already defined in 0_init. The live production migration ledger and failed 0_init logs have not been provided, so whether this is an incomplete baseline, a restored database, or a later schema change is not yet established. The absence of two tables alone does not prove that all other baseline statements succeeded.

Migration `20261020090000_repair_notification_management_tables` copies the exact table definitions and event unique indexes from 0_init, qualifying them with public and using IF NOT EXISTS. It is transactional and has a five-second lock timeout. It creates no notification history, FCM token, employee or unrelated tables and deletes no data. Neither model declares a foreign key. Prisma schema is unchanged, so client regeneration is not required for these model definitions.

IF NOT EXISTS deliberately does not repair an incompatible pre-existing table or index. Inspect the types, defaults, primary keys and event unique indexes before application. Incompatible existing definitions require separate reviewed SQL; do not assume the creation migration corrected them.

## Mandatory production evidence before writes

Using the affected VPS console, verify the current container state and capture recent logs:

```bash
cd /opt/quickboom
sudo docker ps -a
sudo docker logs --tail 300 hrm-backend
```

Run scripts/inspect_notification_tables.sql against the **quickboom** production database using psql. It opens a read-only transaction and records the database identity, complete migration ledger including failed logs, notification columns/defaults, indexes and constraints. Keep credentials out of shared output.

Compare the entire production public schema with **all** definitions in prisma/migrations/0_init/migration.sql, including its enums, tables, sequences, indexes and foreign keys. Review the other migration SQL too. Do not infer baseline completion from employee/notification tables alone. Existing successful baseline records must not be edited.

## Backup before any repair

Use the established backup process. For a host PostgreSQL installation, an example is:

```bash
sudo -u postgres pg_dump -Fc -d quickboom -f /var/tmp/quickboom-before-notification-repair.dump
sudo -u postgres pg_restore --list /var/tmp/quickboom-before-notification-repair.dump
```

Verify the archive can be fully restored to an isolated test database/server, then compare representative row counts and required objects. An archive listing alone is not proof of a successful restore. Preserve the backup outside the container and record its location, checksum and restore-verification result. No production backup or restore has been performed by this local change.

## Migration recovery decision

- If there is no unresolved failed migration, use the established deployment workflow to apply the new migration with the installed Prisma CLI and prisma.config.ts.
- If 0_init remains failed, **stop before applying this migration**. Prisma migrate deploy will correctly refuse with P3009. Review its logs and actual effects first. Do not rerun the baseline against existing objects, mark it rolled back without reversing its effects, or mark it applied while baseline objects are missing.
- If the baseline is incomplete, prepare a reviewed, additive completion plan for **all** missing baseline objects. The new migration covers only these two notification tables. Restore-verify the backup before executing any completion SQL. Only after the complete baseline postcondition has been verified should its failed record be resolved using the installed Prisma migrate resolve workflow. Do not change successful migration history or the original baseline file.
- Once the ledger is consistent, apply pending migrations through the existing workflow. If notification tables were created as part of verified baseline completion, this repair migration safely skips their existing objects.

Useful commands inside a stable container:

```bash
sudo docker exec hrm-backend node node_modules/prisma/build/index.js migrate status
# Only after the backup, schema audit and migration-history reconciliation:
sudo docker exec hrm-backend node node_modules/prisma/build/index.js migrate deploy
```

If the backend is restarting, inspect logs first. Use the verified Compose service configuration for a one-off CLI container rather than trying docker exec repeatedly. Do not reset the database, delete volumes, bypass authentication or suppress migration errors as a substitute for repair.

## Seeding and API checks

GET rules/templates remain read-only, returning [] for successful empty results and HTTP 500 for actual database failures. Defaults are initialized only through the existing explicit ensureDefaultNotificationRules helper, not automatically on page loads/startup. The helper now checks both tables within a transaction, upserts defaults by their unique event, preserves existing rows, and logs/rethrows failures. Repeated explicit seeding fills missing defaults without duplicating or overwriting custom records. It does not send pushes itself; the existing scheduler may later process active rules, so decide explicitly whether production defaults should be enabled.

After deploying the code/image and verified migration, restart only the backend if required. Check health, migration status and recent logs. With the existing authorized admin session, verify actual bodies for:

- GET /api/admin/notification-management/rules
- GET /api/admin/notification-management/templates
- POST /api/admin/notification-management/rules (use an agreed controlled rule with push=false, inApp=false and status=INACTIVE; never trigger a production notification for verification)
- PUT /api/admin/notification-management/rules/:id
- GET /api/admin/notifications
- GET /api/admin/notification-management/devices

Confirm existing records remain intact and that the exercised paths emit no P2021/P2022/P3009/500 errors. A public unauthenticated 401 checks middleware reachability only, not the rules query. No authenticated production API verification has yet been performed from this workspace.

## Local verification

`npm run build` passed. `node scripts/test_notification_table_repair.cjs` passed on a disposable PostgreSQL cluster: missing-table creation, repeat application/data preservation, event uniqueness, repeated real Prisma seeding preserving custom rows, and failed seeding without partial writes when the template table is unavailable. The cluster is stopped afterward. It does not read the configured production database. `node scripts/test_notification_rules.cjs` tests the existing HTTP behavior using a database double.

Production status remains **pending** until the actual failed migration effects, backup restore and authenticated API checks above are verified. No deployment file or shell script is changed by this patch.
