#!/bin/sh
# entrypoint.sh — Prisma migration runner
set -e

echo "🚀 Running prisma migrate deploy..."
npx prisma migrate deploy

echo "✅ Migrations complete. Starting server..."
exec node dist/index.js
