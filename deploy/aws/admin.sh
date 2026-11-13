#!/usr/bin/env bash
# ============================================================================
# HRM Admin Panel — redeploy ONLY the admin container.
#
# Called by the admin repo's CI. Does not touch the API container.
# No migration step: the admin panel has no database of its own.
#
# Usage on the server:  cd /var/www/hrm && ./admin.sh
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

# ---- 1. Pull image ----------------------------------------------------------
ecr_login
pull_image "${ADMIN_IMAGE}"

# ---- 2. nginx site (admin only) ----------------------------------------------
install_vhost "${ADMIN_DOMAIN}"

# ---- 3. (Re)start admin container ---------------------------------------------
bash "${SCRIPT_DIR}/start-admin.sh"

# ---- 4. Cleanup -----------------------------------------------------------
log "Pruning dangling images"
docker image prune -f >/dev/null || true

log "Admin deploy complete. Image: ${ADMIN_IMAGE}"
docker ps --filter "name=${ADMIN_CONTAINER}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
