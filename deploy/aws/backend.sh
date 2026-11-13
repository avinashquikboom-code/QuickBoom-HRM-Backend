#!/usr/bin/env bash
# ============================================================================
# HRM Backend API — redeploy ONLY the API container.
#
# Called by the backend repo's CI. Does not touch the admin container.
#
# Steps: pull image -> run migrations -> install/reload the API vhost ->
# (re)start the API container -> prune.
#
# FIRST DEPLOY: restore the database dump into the `hrm` database BEFORE running
# this. An empty database would get a brand-new schema from the migrations and the
# restore would then collide with it (the container also runs `prisma migrate
# deploy` by itself on every start, see entrypoint.sh).
#
# Usage on the server:  cd /var/www/hrm && ./backend.sh
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

require_env_file
require_env_values DATABASE_URL JWT_SECRET

# ---- 1. Pull image ----------------------------------------------------------
ecr_login
pull_image "${API_IMAGE}"

# ---- 2. Migrate (before the new code starts) ----------------------------------
bash "${SCRIPT_DIR}/migrate.sh"

# ---- 3. nginx site (API only) -------------------------------------------------
install_vhost "${API_DOMAIN}"

# ---- 4. (Re)start API container ----------------------------------------------
bash "${SCRIPT_DIR}/start-api.sh"

# ---- 5. Cleanup -----------------------------------------------------------
log "Pruning dangling images"
docker image prune -f >/dev/null || true

log "Backend deploy complete. Image: ${API_IMAGE}"
docker ps --filter "name=${API_CONTAINER}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
