#!/bin/sh
# entrypoint.sh — Prisma migration runner & server starter

echo "🚀 Generating Prisma client..."
npx prisma generate || echo "Prisma generate notice"

echo "🚀 Running prisma migrate deploy..."
npx prisma migrate deploy || echo "Prisma migrate deploy non-blocking notice"

echo "✅ Starting server..."
exec node dist/index.js
