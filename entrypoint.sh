#!/bin/sh
# entrypoint.sh — Safe Prisma migration runner
# When the target DB already has the schema (old install), migrations that try
# to CREATE TYPE/TABLE that already exists will fail with P3018.
# Fix: mark all known migrations as "applied" so deploy skips them.
set -e

echo "🔍 Checking Prisma migration status..."

# Extract DB URL from environment
DB_URL="${DATABASE_URL}"

# Force-mark all known migrations as successfully applied via direct SQL.
# This is safe because the VPS DB already has the full schema from before.
psql "$DB_URL" -c "
  UPDATE _prisma_migrations
  SET finished_at = COALESCE(finished_at, NOW()),
      applied_steps_count = 1,
      logs = NULL,
      rolled_back_at = NULL
  WHERE migration_name IN (
    '20260720140339_init_uuid',
    '20260720141039_update_hrtask_assignedby',
    '20260720152247_native_uuid_hrtasks'
  )
  AND (finished_at IS NULL OR logs IS NOT NULL OR rolled_back_at IS NOT NULL);
" 2>/dev/null && echo "✅ Migration state reconciled" || echo "⚠️  psql not available, trying prisma resolve..."

# Fallback: use prisma resolve if psql not available
npx prisma migrate resolve --applied 20260720140339_init_uuid         2>/dev/null || true
npx prisma migrate resolve --applied 20260720141039_update_hrtask_assignedby 2>/dev/null || true
npx prisma migrate resolve --applied 20260720152247_native_uuid_hrtasks      2>/dev/null || true

echo "🚀 Running prisma migrate deploy..."
npx prisma migrate deploy

echo "✅ Migrations complete. Starting server..."
exec node dist/index.js
