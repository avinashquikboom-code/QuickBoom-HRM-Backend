#!/bin/sh
# entrypoint.sh — Safe Prisma migration runner
# Automatically resolves any failed migrations before deploying,
# preventing P3009 loops caused by partial schema conflicts on the target DB.
set -e

echo "🔍 Checking Prisma migration status..."

# Resolve any stuck/failed migrations so deploy can proceed
npx prisma migrate resolve --rolled-back 20260720140339_init_uuid 2>/dev/null && \
  echo "⚠️  Resolved failed migration: 20260720140339_init_uuid" || true

npx prisma migrate resolve --rolled-back 20260720141039_update_hrtask_assignedby 2>/dev/null && \
  echo "⚠️  Resolved failed migration: 20260720141039_update_hrtask_assignedby" || true

npx prisma migrate resolve --rolled-back 20260720152247_native_uuid_hrtasks 2>/dev/null && \
  echo "⚠️  Resolved failed migration: 20260720152247_native_uuid_hrtasks" || true

echo "🚀 Running prisma migrate deploy..."
npx prisma migrate deploy

echo "✅ Migrations complete. Starting server..."
exec node dist/index.js
