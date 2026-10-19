-- Read-only evidence collection. Run against the affected quickboom database.
BEGIN READ ONLY;
SELECT current_database() AS database, current_schema() AS schema;
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs
FROM public."_prisma_migrations" ORDER BY started_at;
SELECT table_name, column_name, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('NotificationRule','NotificationTemplate')
ORDER BY table_name, ordinal_position;
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('NotificationRule','NotificationTemplate');
SELECT conrelid::regclass AS relation, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (to_regclass('public."NotificationRule"'),to_regclass('public."NotificationTemplate"'));
COMMIT;
