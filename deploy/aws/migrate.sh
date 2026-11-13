#!/usr/bin/env bash
# ============================================================================
# HRM Backend — apply pending Prisma migrations.
#
# Runs `prisma migrate deploy` in a throwaway container from the pulled image,
# using the same DATABASE_URL the API container will use. (prisma.config.ts in
# the image supplies the datasource URL.)
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

require_env_file
require_env_values DATABASE_URL
ensure_network

log "Applying Prisma migrations"

docker run --rm \
  --memory "${MIGRATE_MEMORY}" --memory-swap "${MIGRATE_MEMORY}" \
  --network "${DOCKER_NETWORK}" \
  --env-file "${ENV_FILE}" \
  "${API_IMAGE}" \
  npx prisma migrate deploy

log "Migrations applied."
