#!/usr/bin/env bash
# ============================================================================
# HRM — create the first SUPER_ADMIN login (plus the 3 default pricing plans)
# in a fresh database. Run once, AFTER backend.sh has created the schema.
#
# Usage:  ./create-admin.sh [email]            # default admin@hrm.com, random password
#         ADMIN_PASSWORD='...' ./create-admin.sh you@example.com
#         ADMIN_RESET=1 ./create-admin.sh      # reset that user's password
#
# A generated password is printed once and saved to secrets/initial-admin.txt
# (mode 600). Change it after the first login, then delete that file.
# Idempotent: an existing user is left untouched unless ADMIN_RESET=1.
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

require_env_file
require_env_values DATABASE_URL
ensure_network

ADMIN_EMAIL="${1:-${ADMIN_EMAIL:-admin@hrm.com}}"
generated=0
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-20)"
  generated=1
fi

log "Creating admin ${ADMIN_EMAIL} (image ${API_IMAGE})"
rc=0
docker run --rm \
  --memory "${MIGRATE_MEMORY}" --memory-swap "${MIGRATE_MEMORY}" \
  --network "${DOCKER_NETWORK}" \
  --env-file "${ENV_FILE}" \
  -e ADMIN_EMAIL="${ADMIN_EMAIL}" \
  -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  -e ADMIN_RESET="${ADMIN_RESET:-0}" \
  -v "${SCRIPT_DIR}/create-admin.js:/app/create-admin.js:ro" \
  "${API_IMAGE}" \
  node /app/create-admin.js || rc=$?

if [[ "${rc}" == "10" ]]; then
  log "Admin already exists — nothing changed."
  exit 0
elif [[ "${rc}" != "0" ]]; then
  die "create-admin failed (exit ${rc})"
fi

if [[ "${generated}" == "1" ]]; then
  mkdir -p "${DEPLOY_DIR}/secrets"
  ( umask 077; printf 'email: %s\npassword: %s\n' "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" > "${DEPLOY_DIR}/secrets/initial-admin.txt" )
  log "Login:    ${ADMIN_EMAIL}"
  log "Password: ${ADMIN_PASSWORD}   (also saved in ${DEPLOY_DIR}/secrets/initial-admin.txt — change it after first login, then delete that file)"
fi
