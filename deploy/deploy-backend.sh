#!/usr/bin/env bash
# Deploy the HRM backend: pull latest image from ECR and (re)start it with limits.
#   Usage: ./deploy-backend.sh
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/config.sh"

preflight
ecr_login
ensure_network

run_service \
  "$BACKEND_CONTAINER" \
  "$(backend_image)" \
  "${BACKEND_PORT}:5004" \
  "$BACKEND_ENV_FILE" \
  "$BACKEND_CPUS" "$BACKEND_MEMORY" "$BACKEND_MEMORY_RESERVATION" \
  --health-cmd 'node dist/health-check.js || exit 1' \
  --health-interval 30s --health-timeout 5s --health-retries 3 --health-start-period 20s

log "Pruning dangling images"
docker image prune -f >/dev/null || true
status
ok "Backend deployed: $(backend_image)"
